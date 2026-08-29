import { cp, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { DemoWorkflow } = require('../dist/apps/server/src/demo-workflow.js');

const outputDirectory = resolve(process.argv[2] ?? 'pages-dist');
await mkdir(outputDirectory, { recursive: true });
await cp(resolve('apps/web/public'), outputDirectory, { recursive: true });

const approvedWorkflow = new DemoWorkflow();
const approved = [approvedWorkflow.snapshot()];
for (let step = 0; step < 20 && approved.at(-1)?.phase !== 'AWAITING_APPROVAL'; step += 1) {
  approved.push(approvedWorkflow.advance());
}

const pendingApproval = approved.at(-1)?.approvals.find((item) => item.status === 'PENDING');
if (approved.at(-1)?.phase !== 'AWAITING_APPROVAL' || pendingApproval === undefined) {
  throw new Error('static fixture did not reach the approval boundary');
}
approved.push(approvedWorkflow.decideApproval(pendingApproval.id, 'APPROVED'));
approved.push(approvedWorkflow.advance());
if (approved.at(-1)?.phase !== 'COMPLETED' || approved.at(-1)?.completionCertificate === undefined) {
  throw new Error('static fixture did not reach certified completion');
}

const deniedWorkflow = new DemoWorkflow();
let denied = deniedWorkflow.snapshot();
for (let step = 0; step < 20 && denied.phase !== 'AWAITING_APPROVAL'; step += 1) {
  denied = deniedWorkflow.advance();
}
const deniedApproval = denied.approvals.find((item) => item.status === 'PENDING');
if (deniedApproval === undefined) throw new Error('denial fixture did not reach approval');
denied = deniedWorkflow.decideApproval(deniedApproval.id, 'DENIED');
if (denied.status !== 'BLOCKED') throw new Error('denied fixture did not fail closed');

await writeFile(
  resolve(outputDirectory, 'static-demo.json'),
  `${JSON.stringify({ approved, denied })}\n`,
  'utf8',
);
await writeFile(resolve(outputDirectory, '.nojekyll'), '', 'utf8');

console.log(`GitHub Pages artifact built at ${outputDirectory}`);
