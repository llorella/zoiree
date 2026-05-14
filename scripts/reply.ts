const args = Bun.argv.slice(2);
if (!args.includes("--kind")) {
  args.unshift("--kind", "user_message");
}

const proc = Bun.spawn(["bun", "run", "scripts/send_message.ts", ...args], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await proc.exited);

export {};
