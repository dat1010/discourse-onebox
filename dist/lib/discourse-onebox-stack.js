"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiscourseOneBoxStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const aws_ec2_1 = require("aws-cdk-lib/aws-ec2");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const fs_1 = require("fs");
const path = __importStar(require("path"));
class DiscourseOneBoxStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Use the default VPC for simplicity
        const vpc = aws_ec2_1.Vpc.fromLookup(this, 'Vpc', { isDefault: true });
        const sg = new aws_ec2_1.SecurityGroup(this, 'DiscourseSg', {
            vpc,
            allowAllOutbound: true,
            description: 'Allow HTTP/HTTPS (and SSH if desired)',
        });
        sg.addIngressRule(aws_ec2_1.Peer.anyIpv4(), aws_ec2_1.Port.tcp(80));
        sg.addIngressRule(aws_ec2_1.Peer.anyIpv4(), aws_ec2_1.Port.tcp(443));
        // tighten SSH if you can (replace 1.2.3.4 with your public IP)
        // sg.addIngressRule(Peer.ipv4('1.2.3.4/32'), Port.tcp(22));
        sg.addIngressRule(aws_ec2_1.Peer.anyIpv4(), aws_ec2_1.Port.tcp(22));
        const role = new aws_iam_1.Role(this, 'DiscourseInstanceRole', {
            assumedBy: new aws_iam_1.ServicePrincipal('ec2.amazonaws.com'),
            managedPolicies: [
                aws_iam_1.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
            ],
        });
        // Amazon Linux 2023 (x86_64)
        const ami = aws_ec2_1.MachineImage.latestAmazonLinux2023({
            cpuType: aws_ec2_1.AmazonLinuxCpuType.X86_64,
        });
        const userData = aws_ec2_1.UserData.forLinux();
        userData.addCommands('set -euxo pipefail', 'sudo dnf -y update || true', 'sudo dnf -y install docker git', 'sudo systemctl enable --now docker', 'sudo usermod -aG docker ec2-user || true', 
        // small swap helps on 2GB nodes
        'if ! swapon --show | grep -q /swapfile; then sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo "/swapfile swap swap defaults 0 0" | sudo tee -a /etc/fstab; fi', 
        // Discourse docker repo
        'sudo mkdir -p /var/discourse', 'if [ ! -d /var/discourse/.git ]; then sudo git clone https://github.com/discourse/discourse_docker.git /var/discourse; fi', 'sudo chown -R ec2-user:ec2-user /var/discourse', 
        // install systemd unit that autostarts container if configured
        `sudo tee /etc/systemd/system/discourse-init.service > /dev/null <<'UNIT'
${(0, fs_1.readFileSync)(path.join(__dirname, '..', 'scripts', 'discourse-init.service'), 'utf8')}
UNIT`, 'sudo systemctl daemon-reload', 'echo "UserData done. SSH in and run: sudo -s; cd /var/discourse; ./discourse-setup"');
        const blockDevices = [{
                deviceName: '/dev/xvda',
                volume: aws_ec2_1.BlockDeviceVolume.ebs(40, {
                    encrypted: true,
                    deleteOnTermination: false, // keep data even if instance is terminated
                }),
            }];
        const instance = new aws_ec2_1.Instance(this, 'DiscourseInstance', {
            vpc,
            vpcSubnets: { subnetType: aws_ec2_1.SubnetType.PUBLIC },
            instanceType: aws_ec2_1.InstanceType.of(aws_ec2_1.InstanceClass.T3A, aws_ec2_1.InstanceSize.SMALL), // cheap & fine
            machineImage: ami,
            securityGroup: sg,
            role,
            userData,
            blockDevices,
            ssmSessionPermissions: true,
        });
        // Elastic IP for stable DNS
        const eip = new cdk.aws_ec2.CfnEIP(this, 'DiscourseEip', { domain: 'vpc' });
        new aws_ec2_1.CfnEIPAssociation(this, 'EipAssoc', {
            eip: eip.ref,
            instanceId: instance.instanceId,
        });
        new cdk.CfnOutput(this, 'InstanceId', { value: instance.instanceId });
        new cdk.CfnOutput(this, 'PublicIp', { value: instance.instancePublicIp });
        new cdk.CfnOutput(this, 'ElasticIp', { value: eip.ref });
    }
}
exports.DiscourseOneBoxStack = DiscourseOneBoxStack;
