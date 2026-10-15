import type { Metadata } from 'next';
import { ProfileForm } from '@/features/profile/profile-form';

export const metadata: Metadata = { title: 'Profile' };

export default function ProfilePage() {
  return <ProfileForm />;
}
