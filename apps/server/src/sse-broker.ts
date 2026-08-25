import { ServerResponse } from "node:http";

export class SseBroker {
  private readonly clients = new Set<ServerResponse>();

  public connect(response: ServerResponse): void {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write(`event: connected\ndata: ${JSON.stringify({ connected: true })}\n\n`);
    this.clients.add(response);
    response.on("close", () => this.clients.delete(response));
  }

  public publish(event: string, data: unknown): void {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) client.write(message);
  }

  public close(): void {
    for (const client of this.clients) client.end();
    this.clients.clear();
  }
}
