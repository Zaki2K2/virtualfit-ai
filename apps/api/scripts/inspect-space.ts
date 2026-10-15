/**
 * Prints the real API of a Gradio Hugging Face Space (endpoints, parameter names, types).
 * Use it to fill GRADIO_API_NAME and GRADIO_PARAMS_TEMPLATE - never guess them.
 *
 *   npm run ai:inspect -- owner/space-name
 *
 * Sends no images; it only reads the Space's API description.
 */
async function main() {
  const spaceId = process.argv[2] ?? process.env.GRADIO_SPACE_ID;
  if (!spaceId) {
    console.error('Usage: npm run ai:inspect -- owner/space-name');
    process.exit(1);
  }
  const token = process.env.HF_TOKEN as `hf_${string}` | undefined;
  const { Client } = await import('@gradio/client');
  const client = await Client.connect(spaceId, token ? { token } : {});
  const api = await client.view_api();
  console.log(JSON.stringify(api, null, 2));
}

main().catch((err) => {
  console.error(`Could not inspect Space: ${(err as Error).message}`);
  process.exit(1);
});
