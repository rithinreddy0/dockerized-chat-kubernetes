import { startChat } from './app.js';

try {
  const server = await startChat();
  let exiting = false;
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
    if (exiting) return;
    exiting = true;
    console.log(`${signal}: draining connections`);
    const deadline = setTimeout(() => process.exit(1), 20000);
    deadline.unref();
    await server.stop();
    clearTimeout(deadline);
    process.exit(0);
  });
} catch (error) {
  console.error(`Startup failed: ${error.message}`);
  process.exit(1);
}
