import { redirect } from 'next/navigation';

// The old simulated "AI Workflow" preview. The real pipeline is the QA Agent.
export default function WorkflowPage() {
  redirect('/dashboard/qa-agent');
}
