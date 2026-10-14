import ActivityClient from "./ActivityClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Activity — Outbounder",
  description: "Read-only send history, SMTP acceptance events and suppression counts.",
};

export default function ActivityPage() {
  return <ActivityClient />;
}
