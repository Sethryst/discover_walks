import fs from 'node:fs';
import path from 'node:path';

export default class QualificationReporter {
  onBegin(_, suite) { this.startedAt = new Date().toISOString(); this.results = []; this.total = suite.allTests().length; }
  onTestEnd(test, result) {
    this.results.push({ project: test.parent.project()?.name || 'unknown', title: test.title, status: result.status, durationMs: result.duration, errors: result.errors.map((e) => e.message), attachments: result.attachments.map((a) => a.path).filter(Boolean) });
  }
  onEnd(result) {
    const output = process.env.QUALIFICATION_OUTPUT || path.resolve('test-results/qualification');
    fs.mkdirSync(output, { recursive: true });
    const receipt = { generatedAt: new Date().toISOString(), startedAt: this.startedAt, outcome: result.status, total: this.total, results: this.results, physicalDevice: [
      'NOT TESTED — real iPhone Safari/WebKit behavior and PWA install/update',
      'NOT TESTED — GPS permission, background/resume, motion/step sensors, camera, audio, battery and thermal behavior',
      'NOT TESTED — real regional Valhalla graph performance and large-package limits on iPhone storage/memory',
      'NOT TESTED — airplane-mode restart and basemap behavior on physical hardware'
    ]};
    fs.writeFileSync(path.join(output, 'qualification.json'), JSON.stringify(receipt, null, 2) + '\n');
    const lines = [`# Walk & Wildlife release qualification`, ``, `Generated: ${receipt.generatedAt}`, `Outcome: **${receipt.outcome.toUpperCase()}**`, ``, `| Project | Check | Status | Duration |`, `|---|---|---|---:|`];
    for (const item of this.results) lines.push(`| ${item.project} | ${item.title.replaceAll('|', '\\|')} | **${item.status.toUpperCase()}** | ${item.durationMs} ms |`);
    lines.push('', '## Physical-device qualification', '', ...receipt.physicalDevice.map((item) => `- ${item}`));
    lines.push('', '## Evidence', '', 'Failure screenshots/traces are stored beside `qualification.json` when Playwright captures them.');
    fs.writeFileSync(path.join(output, 'qualification.md'), lines.join('\n') + '\n');
    console.log(`Qualification report: ${path.join(output, 'qualification.md')}`);
  }
}
