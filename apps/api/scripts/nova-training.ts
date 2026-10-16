/** Local operator CLI only. No HTTP route can approve or export training samples. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadEnv } from '../src/config/env';
import { connectMongo, disconnectMongo } from '../src/db/connect';
import { mongoCollectionFactory } from '../src/db/collection';
import { NovaStore } from '../src/modules/nova/models';
import { reviewedTrainingRecord } from '../src/modules/nova/training';

async function main() {
  const env = loadEnv();
  if (!env.MONGODB_URI)
    throw new Error('MongoDB must be configured; training review never uses ephemeral storage.');
  await connectMongo(env.MONGODB_URI);
  try {
    const store = new NovaStore(mongoCollectionFactory);
    const [command, id, decision] = process.argv.slice(2);
    if (command === 'verify' && id) {
      const bundle = JSON.parse(await readFile(id, 'utf8')) as {
        sourceIds: string[];
        datasetVersion: string;
      };
      const unique = new Map<string, ReturnType<typeof reviewedTrainingRecord>>();
      for (const sourceId of bundle.sourceIds) {
        const row = await store.training.get(sourceId);
        if (!row)
          throw new Error(
            'An exported submission was deleted or consent was revoked. Do not train/activate this dataset.',
          );
        const record = reviewedTrainingRecord(row);
        unique.set(record.scenario, record);
      }
      const records = [...unique.values()].sort((a, b) => a.scenario.localeCompare(b.scenario));
      const version =
        'nova-reviewed-' +
        createHash('sha256').update(JSON.stringify(records)).digest('hex').slice(0, 16);
      if (version !== bundle.datasetVersion)
        throw new Error('Reviewed export no longer matches current approved data/configuration.');
      console.log(
        'Dataset sources still have consent and operator approval; no training or activation performed.',
      );
      return;
    }
    if (command === 'list') {
      console.log(JSON.stringify(await store.training.find(), null, 2));
      return;
    }
    if (command === 'review' && id && ['approved', 'rejected'].includes(decision ?? '')) {
      const row = await store.training.get(id);
      if (!row) throw new Error('Unknown submission.');
      if (decision === 'approved') reviewedTrainingRecord({ ...row, reviewStatus: 'approved' });
      await store.training.update(id, {
        reviewStatus: decision!,
        qualityStatus: decision === 'approved' ? 'contract-validated' : 'rejected',
      });
      console.log(`Submission ${id}: ${decision}. No training started.`);
      return;
    }
    if (command === 'export' && id) {
      const eligible = (await store.training.find()).filter(
        (r) =>
          r.consent && r.reviewStatus === 'approved' && r.qualityStatus === 'contract-validated',
      );
      const unique = new Map<string, ReturnType<typeof reviewedTrainingRecord>>();
      for (const row of eligible) {
        const record = reviewedTrainingRecord(row);
        unique.set(record.scenario, record);
      }
      if (unique.size < 3)
        throw new Error(
          'At least three unique approved examples are required for disjoint splits.',
        );
      const records = [...unique.values()].sort((a, b) => a.scenario.localeCompare(b.scenario));
      const datasetVersion =
        'nova-reviewed-' +
        createHash('sha256').update(JSON.stringify(records)).digest('hex').slice(0, 16);
      const exportData = {
        datasetVersion,
        createdAt: new Date().toISOString(),
        sourceIds: eligible.map((r) => r.id),
        records,
      };
      // Exclusive creation avoids silently overwriting an earlier reviewed dataset.
      await writeFile(id, JSON.stringify(exportData, null, 2), { flag: 'wx', mode: 0o600 });
      for (const row of eligible) await store.training.update(row.id, { datasetVersion });
      console.log(
        `Exported ${records.length} reviewed examples to ${id}. Run the existing Python dataset validator before training.`,
      );
      return;
    }
    throw new Error(
      'Usage: nova:training -- list | review <id> approved|rejected | export <new-file.json>',
    );
  } finally {
    await disconnectMongo();
  }
}
void main().catch((e: Error) => {
  console.error(e.message);
  process.exitCode = 1;
});
