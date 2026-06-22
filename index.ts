import { config } from 'dotenv';
import { streamText } from 'ai';

// Load AI_GATEWAY_API_KEY from .env.local
config({ path: '.env.local' });

async function main() {
  const result = streamText({
    // A plain "provider/model" string routes through the Vercel AI Gateway,
    // authenticated with AI_GATEWAY_API_KEY.
    model: 'openai/gpt-5.4',
    prompt: 'Write a short haiku about streaming text from an AI gateway.',
  });

  // Stream the response to stdout as it arrives.
  for await (const textPart of result.textStream) {
    process.stdout.write(textPart);
  }
  process.stdout.write('\n');

  // Log token usage once the stream completes.
  const usage = await result.usage;
  console.log('\nToken usage:', usage);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
