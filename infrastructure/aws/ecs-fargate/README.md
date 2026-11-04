# sqlib on ECS Fargate, backed up to S3

A Terraform example of [backup to blob storage](../../../docs/guides/deploying.md#backup-to-blob-storage)
on AWS. Copy it and adjust; it is not a versioned module.

It creates:

- An S3 bucket: public access blocked, ACLs off, KMS default encryption with a
  bucket key, versioning with 7-day expiry of old versions, TLS required, and
  (by default) reachable only through the VPC's S3 gateway endpoint and by the
  admin roles you name.
- A KMS key with rotation.
- An S3 gateway endpoint on the private route tables (or uses yours), so backup
  traffic needs no NAT gateway.
- A task role that can list, read, write and delete under this deployment's
  prefix only, and use the key. Litestream and the lease find it through the
  ECS container credentials endpoint; no key is stored anywhere.
- A security group: in from the groups you name, out on 443 to S3 and to what
  sqlib itself calls.
- An ECS cluster, log group, task definition and service with one task,
  replaced stop-first (`minimumHealthyPercent: 0`), so two tasks never write
  the replica at once.

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

With `restrict_bucket_to_vpce` on (the default), a restore from a laptop works
only for the roles in `bucket_admin_role_arns`.
