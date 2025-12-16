import fs from "node:fs";
import path from "node:path";
import HomeClient from "./HomeClient";

export const metadata = {
  title: "Dr Samith Kalyan | Virtual Medical Doctor (South Africa)",
  description:
    "Virtual GP-style care for South Africa: clear explanations, mental health support, healthy weight management, and evidence-based guidance.",
};

export default function Page() {
  const htmlPath = path.join(process.cwd(), "app", "content.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  return <HomeClient html={html} />;
}
