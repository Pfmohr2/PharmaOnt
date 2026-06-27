import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export class MemoryMetricSink {
  constructor({ clock = systemClock } = {}) {
    this.clock = clock;
    this.events = [];
  }

  async increment(name, value = 1, labels = {}) {
    return this.emit("counter", name, value, labels);
  }

  async observe(name, value, labels = {}) {
    return this.emit("histogram", name, value, labels);
  }

  async gauge(name, value, labels = {}) {
    return this.emit("gauge", name, value, labels);
  }

  async emit(type, name, value, labels) {
    const event = {
      type,
      name,
      value,
      labels,
      observed_at: this.clock.now().toISOString()
    };
    this.events.push(event);
    return event;
  }
}

export class LocalJsonlMetricSink extends MemoryMetricSink {
  constructor({ metricPath, clock = systemClock }) {
    super({ clock });
    if (!metricPath) {
      throw new Error("LocalJsonlMetricSink requires metricPath");
    }
    this.metricPath = resolve(metricPath);
  }

  async emit(type, name, value, labels) {
    const event = await super.emit(type, name, value, labels);
    await mkdir(dirname(this.metricPath), { recursive: true });
    await appendFile(this.metricPath, `${JSON.stringify(event)}\n`);
    return event;
  }
}

export const systemClock = {
  now() {
    return new Date();
  }
};
