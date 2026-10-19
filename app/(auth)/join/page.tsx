import JoinForm from "./join-form";

export const metadata = { title: "KOVA — Set up your account" };

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return <JoinForm token={typeof token === "string" ? token : ""} />;
}
