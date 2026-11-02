/** Dev/test provider: prints the message instead of sending it. */
export async function send(to: string, text: string): Promise<void> {
  console.log(`SMS[log] to ${to}: ${text}`);
}
