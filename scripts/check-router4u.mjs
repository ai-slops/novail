import { assertSupportedNode, router4uConfig } from './router4u-config.mjs';
import { checkRouter4u } from './router4u-readiness.mjs';
import { runPartProbe } from './router4u-part-probe.mjs';

const HELP = `Usage: node scripts/check-router4u.mjs [--generate]

Checks Router4U readiness using only authenticated GET /v1/models and
GET /v1/capabilities. --generate explicitly opts in to one isolated NOVAIL
Part run, which can consume provider quota. No OAuth or credentials are read
from Router4U; configure OPENAI_BASE_URL, OPENAI_API_KEY, and OPENAI_MODEL.
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
  assertSupportedNode();
  const config = router4uConfig();
  const readiness = await checkRouter4u(config);
  process.stdout.write(`READINESS PASS model=${readiness.model}\n`);
  process.stdout.write(`MODELS available=${readiness.modelIds.join(',')}\n`);
  process.stdout.write('CAPABILITIES chat=advertised stream=advertised tools=advertised strict_json_schema=UNVERIFIED\n');
  if (!options.generate) {
    process.stdout.write('GENERATION skipped (use --generate to opt in; may consume provider quota)\n');
    return;
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
  const message = error instanceof Error ? error.message : 'Router4U check failed.';
  process.stderr.write(`${code}: ${message}\n`);
  process.exitCode = 1;
}
