#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DiscourseOneBoxStack } from '../lib/discourse-onebox-stack';

const app = new cdk.App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};


new DiscourseOneBoxStack(app, 'DiscourseOneBoxStack', { env });
