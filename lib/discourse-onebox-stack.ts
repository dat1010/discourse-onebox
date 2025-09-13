import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  BlockDevice,
  BlockDeviceVolume,
  CfnEIPAssociation,
  Instance,
  InstanceClass,
  InstanceSize,
  InstanceType,
  IVpc,
  MachineImage,
  AmazonLinuxCpuType,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  UserData,
  Vpc,
} from 'aws-cdk-lib/aws-ec2';
import { ManagedPolicy, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { readFileSync } from 'fs';
import * as path from 'path';

export class DiscourseOneBoxStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Use the default VPC for simplicity
    const vpc: IVpc = Vpc.fromLookup(this, 'Vpc', { isDefault: true });

    const sg = new SecurityGroup(this, 'DiscourseSg', {
      vpc,
      allowAllOutbound: true,
      description: 'Allow HTTP/HTTPS (and SSH if desired)',
    });
    sg.addIngressRule(Peer.anyIpv4(), Port.tcp(80));
    sg.addIngressRule(Peer.anyIpv4(), Port.tcp(443));
    // tighten SSH if you can (replace 1.2.3.4 with your public IP)
    // sg.addIngressRule(Peer.ipv4('1.2.3.4/32'), Port.tcp(22));
    sg.addIngressRule(Peer.anyIpv4(), Port.tcp(22));

    const role = new Role(this, 'DiscourseInstanceRole', {
      assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    // Amazon Linux 2023 (x86_64)
    const ami = MachineImage.latestAmazonLinux2023({
      cpuType: AmazonLinuxCpuType.X86_64,
    });

    const userData = UserData.forLinux();
    userData.addCommands(
      'set -euxo pipefail',
      'sudo dnf -y update || true',
      'sudo dnf -y install docker git',
      'sudo systemctl enable --now docker',
      'sudo usermod -aG docker ec2-user || true',
      // small swap helps on 2GB nodes
      'if ! swapon --show | grep -q /swapfile; then sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo "/swapfile swap swap defaults 0 0" | sudo tee -a /etc/fstab; fi',
      // Discourse docker repo
      'sudo mkdir -p /var/discourse',
      'if [ ! -d /var/discourse/.git ]; then sudo git clone https://github.com/discourse/discourse_docker.git /var/discourse; fi',
      'sudo chown -R ec2-user:ec2-user /var/discourse',
      // install systemd unit that autostarts container if configured
      `sudo tee /etc/systemd/system/discourse-init.service > /dev/null <<'UNIT'
${readFileSync(path.join(__dirname, '..', 'scripts', 'discourse-init.service'), 'utf8')}
UNIT`,
      'sudo systemctl daemon-reload',
      'echo "UserData done. SSH in and run: sudo -s; cd /var/discourse; ./discourse-setup"'
    );

    const blockDevices: BlockDevice[] = [{
      deviceName: '/dev/xvda',
      volume: BlockDeviceVolume.ebs(40, {
        encrypted: true,
        deleteOnTermination: false, // keep data even if instance is terminated
      }),
    }];

    const instance = new Instance(this, 'DiscourseInstance', {
      vpc,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      instanceType: InstanceType.of(InstanceClass.T3A, InstanceSize.SMALL), // cheap & fine
      machineImage: ami,
      securityGroup: sg,
      role,
      userData,
      blockDevices,
      ssmSessionPermissions: true,
    });

    // Elastic IP for stable DNS
    const eip = new cdk.aws_ec2.CfnEIP(this, 'DiscourseEip', { domain: 'vpc' });
    new CfnEIPAssociation(this, 'EipAssoc', {
      eip: eip.ref,
      instanceId: instance.instanceId,
    });

    new cdk.CfnOutput(this, 'InstanceId', { value: instance.instanceId });
    new cdk.CfnOutput(this, 'PublicIp', { value: instance.instancePublicIp });
    new cdk.CfnOutput(this, 'ElasticIp', { value: eip.ref });
  }
}

