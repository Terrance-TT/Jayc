import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { useLoaderData } from '@remix-run/react';
import { useEffect, useRef, useState } from 'react';

/*
 * Full-page wrapper for a WebContainer preview.
 *
 * Credentialless WebContainer preview URLs (*.local-credentialless.webcontainer-api.io)
 * only resolve inside an iframe embedded in the editor's origin — opening them as a
 * top-level tab returns a 404. This route keeps the preview inside an iframe while
 * giving the user a dedicated browser tab.
 */

export async function loader({ params }: LoaderFunctionArgs) {
  const previewId = params.id;

  if (!previewId) {
    throw new Response('Preview ID is required', { status: 400 });
  }

  return json({ previewId });
}

export default function WebContainerPreview() {
  const { previewId } = useLoaderData<typeof loader>();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    // Reconstruct the WebContainer preview URL from its ID (the subdomain holds the port).
    const url = `https://${previewId}.local-credentialless.webcontainer-api.io`;
    setPreviewUrl(url);

    if (iframeRef.current) {
      iframeRef.current.src = url;
    }
  }, [previewId]);

  return (
    <div className="w-full h-full">
      <iframe
        ref={iframeRef}
        title="WebContainer Preview"
        className="w-full h-full border-none"
        sandbox="allow-scripts allow-forms allow-popups allow-modals allow-storage-access-by-user-activation allow-same-origin"
        allow="cross-origin-isolated"
        loading="eager"
        src={previewUrl || undefined}
      />
    </div>
  );
}
