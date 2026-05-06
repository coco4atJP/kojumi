import { useEffect, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './Docs.module.css';

export default function Docs() {
  const [documentState, setDocumentState] = useState<{
    path: string;
    content: string;
  }>({ path: '', content: '' });
  const location = useLocation();

  const documentPath = (() => {
    let path = location.pathname.replace('/docs', '');
    if (!path || path === '/') {
      path = '/index.md';
    } else if (!path.endsWith('.md')) {
      path = `${path}.md`;
    }
    return path;
  })();

  useEffect(() => {
    fetch(`/docs_content${documentPath}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error('Not Found');
        }
        return res.text();
      })
      .then((text) => {
        setDocumentState({ path: documentPath, content: text });
      })
      .catch((err) => {
        console.error(err);
        setDocumentState({
          path: documentPath,
          content: '# 404 - Document Not Found\n\nThe requested document could not be found.',
        });
      });
  }, [documentPath]);

  if (documentState.path !== documentPath) {
    return <div className={styles.loading}>Loading document...</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.markdownBody}>
        <ReactMarkdown 
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({...props}) => {
              // Internal markdown links should route within /docs
              if (props.href && !props.href.startsWith('http')) {
                let href = props.href;
                // Ensure it has /docs prefix
                if (!href.startsWith('/')) {
                  href = `/docs/${href}`;
                } else if (!href.startsWith('/docs/')) {
                  href = `/docs${href}`;
                }
                
                // Remove .md extension for cleaner client-side routing
                href = href.replace(/\.md$/, '');
                
                return <Link to={href} {...props} />;
              }
              return <a {...props} target="_blank" rel="noopener noreferrer" />;
            }
          }}
        >
          {documentState.content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
