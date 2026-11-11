# sqlib on ECS Fargate, backed up to S3

A Terraform example of [backup to blob storage](../../../docs/guides/deploying.md#backup-to-blob-storage)
on AWS. Copy it and change it for your account. It is an example, and is not
versioned as a module.

It creates:

- An S3 bucket, with public access blocked, ACLs off, KMS default encryption
  with a bucket key, versioning with 7-day expiry of old versions, and TLS
  required. By default, only the S3 gateway endpoint of the VPC and the admin
  roles that you name can reach it.
- A KMS key with rotation.
- An S3 gateway endpoint on the private route tables, so backup traffic needs
  no NAT gateway. It can use an existing endpoint.
- A task role that can list, read, write and delete under the prefix of this
  deployment only, and use the key. Litestream and the lease find it through
  the ECS container credentials endpoint. No key is stored.
- A security group. It allows ingress from the groups that you name, and
  egress on 443 to S3 and to the services that sqlib calls.
- An ECS cluster, log group, task definition and service with one task,
  replaced stop-first (`minimumHealthyPercent: 0`). Two tasks therefore never
  write the replica at the same time.

It does not create the VPC, the NAT gateway, a load balancer or DNS.

```
terraform init
terraform apply \
  -var name=sqlib-prod -var region=eu-west-1 \
  -var image=ghcr.io/recalcitrantsupplant/sqlib:latest \
  -var bucket_name=acme-sqlib-backup \
  -var vpc_id=vpc-0123 \
  -var 'private_subnet_ids=["subnet-a","subnet-b"]' \
  -var 'private_route_table_ids=["rtb-a","rtb-b"]' \
  -var 'bucket_admin_role_arns=["arn:aws:iam::111122223333:role/ops"]'
```

When `restrict_bucket_to_vpce` is on (the default), only the roles in
`bucket_admin_role_arns` can restore from outside the VPC, for example from a
laptop.
