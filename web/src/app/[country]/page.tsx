import { notFound } from 'next/navigation';
import { KenyaHomepage } from '@/components/homepage/kenya-homepage';

interface CountryPageProps {
  params: Promise<{ country: string }>;
}

export default async function CountryPage({ params }: CountryPageProps) {
  const { country } = await params;
  const normalized = country.toLowerCase().trim();

  // Kenya is the sole operational country baseline in Phase 2
  if (normalized !== 'ke') {
    notFound();
  }

  return <KenyaHomepage />;
}
