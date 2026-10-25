import { BusinessesPage } from "@/features/businesses/page";

export default async function Page({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  return <BusinessesPage tenantId={tenantId} />;
}
