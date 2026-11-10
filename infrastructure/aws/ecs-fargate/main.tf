# sqlib on ECS Fargate with its SQLite store backed up to S3.
#
# An example, not a module to depend on: copy it and adjust. It sets up what
# docs/guides/deploying.md, "Backup to blob storage", recommends for AWS:
#
#   - a private, KMS-encrypted, versioned bucket that only TLS requests and the
#     VPC's S3 gateway endpoint can reach;
#   - a task role that can read and write only this deployment's prefix;
#   - a free S3 gateway endpoint, so backups need no NAT gateway;
#   - one task, replaced stop-first, so two never write the replica at once.
#
# It does not create the VPC, a load balancer or DNS.

provider "aws" {
  region = var.region
}

data "aws_caller_identity" "current" {}

locals {
  prefix     = var.name
  bucket_arn = "arn:aws:s3:::${var.bucket_name}"
  vpce_id    = var.create_s3_gateway_endpoint ? aws_vpc_endpoint.s3[0].id : var.existing_s3_vpce_id
}

# --- encryption key -----------------------------------------------------------

resource "aws_kms_key" "backup" {
  description             = "${var.name} SQLite backup"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "backup" {
  name          = "alias/${var.name}-sqlite-backup"
  target_key_id = aws_kms_key.backup.key_id
}

# --- bucket -------------------------------------------------------------------

resource "aws_s3_bucket" "backup" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_public_access_block" "backup" {
  bucket                  = aws_s3_bucket.backup.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "backup" {
  bucket = aws_s3_bucket.backup.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Default encryption on the bucket, so every writer gets it whatever its config.
resource "aws_s3_bucket_server_side_encryption_configuration" "backup" {
  bucket = aws_s3_bucket.backup.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.backup.arn
    }
    bucket_key_enabled = true
  }
}

# Versioning keeps what Litestream deletes (or a mistake deletes) for 7 days.
# No Object Lock: Litestream removes old files itself.
resource "aws_s3_bucket_versioning" "backup" {
  bucket = aws_s3_bucket.backup.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backup" {
  bucket = aws_s3_bucket.backup.id
  rule {
    id     = "expire-noncurrent"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 7
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
  depends_on = [aws_s3_bucket_versioning.backup]
}

data "aws_iam_policy_document" "bucket" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    resources = [local.bucket_arn, "${local.bucket_arn}/*"]
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  dynamic "statement" {
    for_each = var.restrict_bucket_to_vpce ? [1] : []
    content {
      sid     = "DenyOutsideVpcEndpoint"
      effect  = "Deny"
      actions = ["s3:*"]
      principals {
        type        = "*"
        identifiers = ["*"]
      }
      resources = [local.bucket_arn, "${local.bucket_arn}/*"]
      condition {
        test     = "StringNotEquals"
        variable = "aws:SourceVpce"
        values   = [local.vpce_id]
      }
      # Admins (and Terraform itself, through the account root) may still
      # manage and restore from outside the VPC.
      condition {
        test     = "ArnNotLike"
        variable = "aws:PrincipalArn"
        values = concat(var.bucket_admin_role_arns, [
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root",
          data.aws_caller_identity.current.arn,
        ])
      }
    }
  }
}

resource "aws_s3_bucket_policy" "backup" {
  bucket     = aws_s3_bucket.backup.id
  policy     = data.aws_iam_policy_document.bucket.json
  depends_on = [aws_s3_bucket_public_access_block.backup]
}

# --- network ------------------------------------------------------------------

resource "aws_vpc_endpoint" "s3" {
  count             = var.create_s3_gateway_endpoint ? 1 : 0
  vpc_id            = var.vpc_id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = var.private_route_table_ids
}

data "aws_prefix_list" "s3" {
  name = "com.amazonaws.${var.region}.s3"
}

resource "aws_security_group" "task" {
  name        = "${var.name}-task"
  description = "sqlib task"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "from_callers" {
  for_each                     = toset(var.ingress_security_group_ids)
  security_group_id            = aws_security_group.task.id
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = var.container_port
  to_port                      = var.container_port
}

resource "aws_vpc_security_group_egress_rule" "s3" {
  security_group_id = aws_security_group.task.id
  description       = "S3 through the gateway endpoint: backup, restore and lease"
  prefix_list_id    = data.aws_prefix_list.s3.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "https" {
  for_each          = toset(var.egress_cidr_blocks)
  security_group_id = aws_security_group.task.id
  description       = "What sqlib itself calls: SPARQL endpoints, token issuer, image registry, KMS"
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

# --- roles --------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Pulls the image and writes logs. Not the role the backup uses.
resource "aws_iam_role" "execution" {
  name               = "${var.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# The task's own role: Litestream and the lease find it through the ECS
# container credentials endpoint. Only this deployment's prefix.
data "aws_iam_policy_document" "backup" {
  statement {
    sid       = "ListPrefix"
    actions   = ["s3:ListBucket"]
    resources = [local.bucket_arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = [local.prefix, "${local.prefix}/*"]
    }
  }
  statement {
    sid       = "BucketLocation"
    actions   = ["s3:GetBucketLocation"]
    resources = [local.bucket_arn]
  }
  statement {
    sid       = "ReadWritePrefix"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${local.bucket_arn}/${local.prefix}/*"]
  }
  statement {
    sid       = "UseBackupKey"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = [aws_kms_key.backup.arn]
  }
}

resource "aws_iam_role" "task" {
  name               = "${var.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy" "backup" {
  name   = "sqlite-backup"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.backup.json
}

# --- service ------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "sqlib" {
  name              = "/ecs/${var.name}"
  retention_in_days = var.log_retention_days
}

resource "aws_ecs_cluster" "sqlib" {
  name = var.name
}

resource "aws_ecs_task_definition" "sqlib" {
  family                   = var.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "sqlib"
      image     = var.image
      essential = true
      portMappings = [
        { containerPort = var.container_port, protocol = "tcp" }
      ]
      environment = [
        for k, v in merge({
          SQLIB_SQLITE_REPLICA_URL = "s3://${var.bucket_name}/${local.prefix}"
          AWS_REGION               = var.region
          OTEL_ENABLED             = "false"
        }, var.environment) : { name = k, value = v }
      ]
      # SIGTERM, then this long for the server to stop and Litestream to sync.
      stopTimeout = 30
      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:${var.container_port}/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))\""]
        interval    = 15
        timeout     = 5
        retries     = 3
        startPeriod = 120
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.sqlib.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "sqlib"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "sqlib" {
  name            = var.name
  cluster         = aws_ecs_cluster.sqlib.id
  task_definition = aws_ecs_task_definition.sqlib.arn
  launch_type     = "FARGATE"
  desired_count   = 1

  # Stop the old task before starting the new one: never two writers. A deploy
  # has a short outage instead.
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = false
  }

  dynamic "load_balancer" {
    for_each = var.target_group_arn == "" ? [] : [1]
    content {
      target_group_arn = var.target_group_arn
      container_name   = "sqlib"
      container_port   = var.container_port
    }
  }

  depends_on = [aws_iam_role_policy.backup]
}
