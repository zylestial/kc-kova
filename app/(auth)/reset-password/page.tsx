import ResetForm from "./reset-form";

export const metadata = { title: "KOVA — Reset password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return <ResetForm token={typeof token === "string" ? token : ""} />;
}
