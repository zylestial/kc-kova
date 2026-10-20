import SignInForm from "./sign-in-form";

export const metadata = { title: "KOVA — Sign In" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ reset?: string | string[] }> }) {
  const { reset } = await searchParams;
  return <SignInForm passwordReset={reset === "done"} />;
}
