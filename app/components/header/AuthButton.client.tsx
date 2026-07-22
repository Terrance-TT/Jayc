import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/remix';

export function AuthButton() {
  return (
    <>
      <SignedOut>
        <SignInButton mode="redirect" forceRedirectUrl="/">
          <button
            title="Sign in"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-transparent text-bolt-elements-item-contentDefault hover:text-bolt-elements-item-contentActive hover:bg-bolt-elements-item-backgroundActive text-sm font-medium transition-colors"
          >
            <div className="i-ph:sign-in text-xl" />
            Sign in
          </button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <UserButton afterSignOutUrl="/" />
      </SignedIn>
    </>
  );
}
