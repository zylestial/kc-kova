import ConfirmEmail from "./confirm-email";

export const metadata = { title: "KOVA — Confirm email" };

export default async function ConfirmEmailPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return <ConfirmEmail token={typeof token === "string" ? token : ""} />;
}
