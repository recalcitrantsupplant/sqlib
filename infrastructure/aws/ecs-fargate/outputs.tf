output "replica_url" {
  description = "SQLIB_SQLITE_REPLICA_URL of the service. Restore from it with litestream restore -o library.sqlite <url>/library."
  value       = "s3://${var.bucket_name}/${local.prefix}"
}

output "task_role_arn" {
  description = "The role the backup runs as."
  value       = aws_iam_role.task.arn
}

output "kms_key_arn" {
  value = aws_kms_key.backup.arn
}

output "service_name" {
  value = aws_ecs_service.sqlib.name
}
