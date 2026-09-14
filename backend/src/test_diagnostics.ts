import { getAuthenticatedClientForUser } from './services/gmailConnection.service';
import { google } from 'googleapis';

async function run() {
  const userId = 'usr_g_e34e3b006f279e6f7c3c6469';
  console.log('Authenticating user:', userId);
  try {
    const authClient = await getAuthenticatedClientForUser(userId);
    console.log('Got auth client successfully!');
    const gmail = google.gmail({ version: 'v1', auth: authClient });

    const profile = await gmail.users.getProfile({ userId: 'me' });
    console.log('Gmail Profile:', {
      emailAddress: profile.data.emailAddress,
      messagesTotal: profile.data.messagesTotal,
      historyId: profile.data.historyId,
    });

    // 1. List latest 5 messages in inbox without query
    const resRecent = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 5,
    });
    console.log('Recent messages count:', resRecent.data.messages?.length || 0);

    if (resRecent.data.messages?.length) {
      for (const m of resRecent.data.messages.slice(0, 3)) {
        const full = await gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'metadata' });
        const headers = full.data.payload?.headers || [];
        const subject = headers.find(h => h.name?.toLowerCase() === 'subject')?.value;
        const from = headers.find(h => h.name?.toLowerCase() === 'from')?.value;
        const date = headers.find(h => h.name?.toLowerCase() === 'date')?.value;
        console.log('Sample Message:', { id: m.id, date, from, subject });
      }
    }

    // 2. Test query with 'debited'
    const resDebit = await gmail.users.messages.list({
      userId: 'me',
      q: 'debited',
      maxResults: 10,
    });
    console.log('Messages matching "debited":', resDebit.data.messages?.length || 0);

    // 3. Test query with 'credited'
    const resCredit = await gmail.users.messages.list({
      userId: 'me',
      q: 'credited',
      maxResults: 10,
    });
    console.log('Messages matching "credited":', resCredit.data.messages?.length || 0);

    const { fetchFinancialEmails, parseGmailMessage } = await import('./services/gmail.service');
    console.log('Testing fetchFinancialEmails full scan:');
    const result = await fetchFinancialEmails(authClient, { userId, maxResults: 15 });
    const { parseEmailBatch } = await import('./parsers/email.parser');
    const { classifyEmail } = await import('./parsers/classifier');

    console.log('\n--- Parsing Candidates ---');
    const parsedEmails = result.messages.map(m => parseGmailMessage(m));
    for (const pe of parsedEmails) {
      const cls = classifyEmail({
        subject: pe.subject,
        senderEmail: pe.senderEmail,
        senderDomain: pe.senderDomain,
        body: pe.combinedBody,
      });
      console.log(`[${pe.messageId}] Subject: "${pe.subject}" From: ${pe.from}`);
      console.log(`  Classification: class=${cls.emailClass} type=${cls.type} conf=${cls.confidence}`);
    }

    const { parsed, failures } = parseEmailBatch(parsedEmails);
    console.log(`Regex parsed count: ${parsed.length}, failures: ${failures.length}`);
    for (const tx of parsed) {
      console.log('EXTRACTED TX:', tx);
    }


  } catch (err: any) {
    console.error('Diagnostic error:', err.message, err.response?.data || err);
  }
}

run().then(() => process.exit(0));
