import { ServerResponse } from "node:http";

const DEMO_CHANNEL = "__demo__";

export class SseBroker {
  private readonly clientsByChannel = new Map<string, Set<ServerResponse>>();

  public connect(response: ServerResponse, taskId?: string): void {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write(
      `event: connected\ndata: ${JSON.stringify({ connected: true, taskId: taskId ?? null })}\n\n`,
    );
    const channel = taskId ?? DEMO_CHANNEL;
    const clients = this.clientsByChannel.get(channel) ?? new Set<ServerResponse>();
    clients.add(response);
    this.clientsByChannel.set(channel, clients);
    response.on("close", () => {
      clients.delete(response);
      if (clients.size === 0) this.clientsByChannel.delete(channel);
    });
  }

  public publish(event: string, data: unknown, taskId?: string): void {
    const clients = this.clientsByChannel.get(taskId ?? DEMO_CHANNEL);
    if (clients === undefined) return;
    const message = serialize(event, data);
    for (const client of clients) client.write(message);
  }

  public publishTo(response: ServerResponse, event: string, data: unknown): void {
    response.write(serialize(event, data));
  }

  public close(): void {
    for (const clients of this.clientsByChannel.values()) {
      for (const client of clients) client.end();
    }
    this.clientsByChannel.clear();
  }
}

function serialize(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
