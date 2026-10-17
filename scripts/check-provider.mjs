import { providerConfig } from '../app/provider-config.mjs';
import { checkProvider } from './provider-readiness.mjs';
import { runPartProbe } from './provider-part-probe.mjs';

const HELP = `Usage: node scripts/check-provider.mjs [--generate]

Checks an OpenAI-compatible provider using only authenticated GET /models.
--generate explicitly opts in to one isolated NOVAIL Part run, which can
consume provider quota. Configure OPENAI_BASE_URL, OPENAI_API_KEY, and
OPENAI_MODEL in .env.
`;

function parseArguments(arguments_) {
  if (arguments_.length === 1 && ['--help', '-h'].includes(arguments_[0])) return { help: true, generate: false };
  if (arguments_.length === 0) return { help: false, generate: false };
  if (arguments_.length === 1 && arguments_[0] === '--generate') return { help: false, generate: true };
  const error = new Error('Only --help and --generate are supported.');
  error.code = 'INVALID_ARGUMENT';
  throw error;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  const config = providerConfig(process.env, { requireApiKey: true });
  const readiness = await checkProvider(config);
  process.stdout.write(`PROVIDER_CHECK PASS${readiness.model ? ` default_model=${readiness.model}` : ''}\n`);
  process.stdout.write(`MODEL_CATALOG ${readiness.catalog.toUpperCase()}${readiness.modelIds.length ? ` models=${readiness.modelIds.join(',')}` : ''}\n`);
  process.stdout.write('GENERATION stream=UNVERIFIED tools=UNVERIFIED strict_json_schema=UNVERIFIED\n');
  if (!options.generate) {
    process.stdout.write('GENERATION skipped (use --generate to opt in; may consume provider quota)\n');
    return;
  }
  if (!config.model) {
    const error = new Error('Set OPENAI_MODEL before using --generate.');
    error.code = 'MODEL_REQUIRED';
    throw error;
  }
  const probe = await runPartProbe();
  process.stdout.write(`PART_INTEGRATION PASS result=${probe.resultState}\n`);
  process.stdout.write(`TOOLS exercised=${probe.toolsExercised}\n`);
  process.stdout.write(`HEAD ${probe.headUnchanged ? 'unchanged' : 'changed'}\n`);
  process.stdout.write(`USAGE reserved_calls=${probe.reservedModelCalls} known_tokens=${probe.actualKnownTokens} output_tokens=${probe.actualOutputTokens}\n`);
}

try {
  await main();
} catch (error) {
  const code = error instanceof Error && 'code' in error ? error.code : 'CHECK_FAILED';
  const message = error instanceof Error ? error.message : 'Provider check failed.';
  process.stderr.write(`${code}: ${message}\n`);
  process.exitCode = 1;
}
