export function redisConnection() {
  const parsed = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  const database = parsed.pathname.replace("/", "");
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(database ? { db: Number(database) } : {}),
    ...(parsed.protocol === "rediss:" ? { tls: {} } : {}),
  };
}
