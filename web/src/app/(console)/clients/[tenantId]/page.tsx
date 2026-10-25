import { ClientsPage } from "@/features/clients/page";

export default async function Page({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  return <ClientsPage tenantId={tenantId} />;
}
