data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

resource "aws_security_group" "voice" {
  name        = "${var.instance_name}-sg"
  description = "Porchline voice: SSH from admin, HTTP/HTTPS for Twilio and dashboard callbacks"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_cidr]
  }

  ingress {
    description = "HTTP (Caddy/nginx ACME + redirect)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS / WSS (Twilio Media Streams)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "All outbound (Higgs, Twilio API, Supabase, Netlify publish)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.instance_name}-sg"
  }
}

resource "aws_instance" "voice" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  key_name                    = var.key_name
  subnet_id                   = data.aws_subnets.default.ids[0]
  vpc_security_group_ids      = [aws_security_group.voice.id]
  associate_public_ip_address = true

  root_block_device {
    volume_size = var.root_volume_gb
    volume_type = "gp3"
    encrypted   = true
  }

  user_data = <<-EOT
    #!/bin/bash
    set -euo pipefail
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y python3 python3-venv python3-pip git curl ca-certificates
    # App install, Caddy/nginx TLS, Supabase DATABASE_URL, and systemd unit are done after SSH.
    # Terraform only provisions the host.
  EOT

  tags = {
    Name = var.instance_name
    Role = "voice"
  }
}

resource "aws_eip" "voice" {
  count  = var.associate_elastic_ip ? 1 : 0
  domain = "vpc"

  tags = {
    Name = "${var.instance_name}-eip"
  }
}

resource "aws_eip_association" "voice" {
  count         = var.associate_elastic_ip ? 1 : 0
  instance_id   = aws_instance.voice.id
  allocation_id = aws_eip.voice[0].id
}
