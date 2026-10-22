import './globals.css';

export const metadata = {
  title: 'AgentQA — Agentic QA Operations Platform',
  description: 'AI-Powered Quality Engineering platform bringing requirements analysis, test automation, approvals, and CI-backed results into a single dashboard.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
