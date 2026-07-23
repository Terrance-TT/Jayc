import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { useLoaderData } from '@remix-run/react';
import { useEffect, useRef, useState } from 'react';

/*
 * Full-page wrapper for a WebContainer preview.
 *
 * WebContainer preview URLs only resolve inside an iframe embedded in the
 * editor's origin — opening them as a top-level tab returns a 404. This route
 * keeps the preview inside an iframe while giving the user a dedicated
 * browser tab. The full preview URL is passed as a query param so any
 * WebContainer URL format works (no assumptions about the subdomain scheme).
 */

export async function loader({ request }: LoaderFunctionArgs) {
  const previewUrl = new URL(request.url).searchParams.get('url');

  if (!previewUrl) {
    throw new Response('Preview URL is required', { status: 400 });
  }

  return json({ previewUrl });
}

export default function WebContainerPreview() {
  const { previewUrl } = useLoaderData<typeof loader>();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeUrl, setIframeUrl] = useState('');
  const [isPreviewBannerDismissed, setIsPreviewBannerDismissed] = useState(false);

  useEffect(() => {
    setIframeUrl(previewUrl);

    if (iframeRef.current) {
      iframeRef.current.src = previewUrl;
    }
  }, [previewUrl]);

  return (
    <div className="w-full h-full flex flex-col">
      {!isPreviewBannerDismissed && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-bolt-elements-background-depth-2 border-b border-bolt-elements-borderColor text-bolt-elements-textSecondary text-xs">
          <div className="i-ph:warning-bold text-yellow-500 shrink-0" />
          <span className="flex-1">
            Development preview — do not publish. Secrets in your .env are visible to this app.
          </span>
          <button
            className="i-ph:x shrink-0 hover:text-bolt-elements-textPrimary"
            title="Dismiss"
            onClick={() => setIsPreviewBannerDismissed(true)}
          />
        </div>
      )}
      <iframe
        ref={iframeRef}
        title="WebContainer Preview"
        className="w-full flex-1 border-none"
        sandbox="allow-scripts allow-forms allow-popups allow-modals allow-storage-access-by-user-activation allow-same-origin"
        allow="cross-origin-isolated"
        loading="eager"
        src={iframeUrl || undefined}
      />
    </div>
  );
}
