variable "name" {
  description = "Name prefix for every resource, such as sqlib-prod. Also the replica path in the bucket."
  type        = string
}

variable "region" {
  description = "AWS region. Keep the bucket in the same region as the tasks, so traffic goes through the S3 gateway endpoint."
  type        = string
}

variable "image" {
  description = "The sqlib image, such as ghcr.io/recalcitrantsupplant/sqlib:1.2.3."
  type        = string
}

variable "vpc_id" {
  description = "VPC the task runs in."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnets for the task."
  type        = list(string)
}

variable "private_route_table_ids" {
  description = "Route tables of those subnets, for the S3 gateway endpoint."
  type        = list(string)
}

variable "create_s3_gateway_endpoint" {
  description = "Create the S3 gateway endpoint. Set false when the VPC already has one, and give its ID in existing_s3_vpce_id."
  type        = bool
  default     = true
}

variable "existing_s3_vpce_id" {
  description = "ID of an existing S3 gateway endpoint, when create_s3_gateway_endpoint is false."
  type        = string
  default     = ""
}

variable "restrict_bucket_to_vpce" {
  description = "Deny bucket access from anywhere but the gateway endpoint, except for bucket_admin_role_arns."
  type        = bool
  default     = true
}

variable "bucket_admin_role_arns" {
  description = "Roles that may reach the bucket from outside the VPC (restore drills, break-glass). Without one, a restore must run inside the VPC."
  type        = list(string)
  default     = []
}

variable "bucket_name" {
  description = "Name of the backup bucket. Globally unique."
  type        = string
}

variable "cpu" {
  description = "Task CPU units."
  type        = number
  default     = 512
}

variable "memory" {
  description = "Task memory in MiB."
  type        = number
  default     = 1024
}

variable "container_port" {
  description = "Port the image listens on (dual-http mode: API and MCP)."
  type        = number
  default     = 3000
}

variable "ingress_security_group_ids" {
  description = "Security groups allowed to reach the container port, such as a load balancer's."
  type        = list(string)
  default     = []
}

variable "target_group_arn" {
  description = "Optional load balancer target group to register the task with."
  type        = string
  default     = ""
}

variable "environment" {
  description = "Extra environment variables for sqlib (feature flags, auth settings)."
  type        = map(string)
  default     = {}
}

variable "egress_cidr_blocks" {
  description = "Where else the task may connect on 443: the SPARQL endpoints and token issuer sqlib calls. Through a NAT gateway."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "log_retention_days" {
  description = "CloudWatch log retention."
  type        = number
  default     = 30
}
