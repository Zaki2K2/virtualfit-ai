import type { Metadata } from 'next';
import { NovaClient } from './nova-client';
import './nova.css';

export const metadata: Metadata = {
  title: { absolute: 'Nova AI' },
  description:
    'Nova AI — Powered by NovaCTO. Private local conversations, fashion ideas and approved memory.',
};
export default function NovaPage() {
  return <NovaClient />;
}
