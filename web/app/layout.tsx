import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./simplified.css";
import WorkspaceNav from "./ui/WorkspaceNav";

export const metadata: Metadata = {
  title: "Outbounder",
  description: "Local prospect review, campaign planning and call workflows.",
  applicationName: "Outbounder",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f6f7f9",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="app-container">
          <WorkspaceNav />
          {children}
        </div>
      </body>
    </html>
  );
}
