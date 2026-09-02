const AGENT_ID = 'agent_01VHrqN3WCGb9H6pExH4Mvg1';
const ENV_ID = 'env_01CYx4qZVPwTxSxgdrL9Wj4L';

exports.handler = async function(event, context) {
  if(event.httpMethod !== 'POST'){
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if(!apiKey){
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { message, sessionId, userContext } = body;

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'managed-agents-2026-04-01'
  };

  try {
    if(!sessionId){
      // Create new session
      const initMessage = message + (userContext ? '\n\n[User context:\n' + userContext + ']' : '');
      const resp = await fetch('https://api.anthropic.com/v1/sessions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          agent: AGENT_ID,
          environment_id: ENV_ID,
          initial_events: [{ type: 'user.message', content: initMessage }]
        })
      });
      const data = await resp.json();
      if(data.error) return { statusCode: 400, body: JSON.stringify({ error: data.error.message }) };

      const newSessionId = data.id;

      // Poll for response
      const reply = await pollForResponse(newSessionId, headers);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ reply, sessionId: newSessionId })
      };
    } else {
      // Resume session
      const resp = await fetch(`https://api.anthropic.com/v1/sessions/${sessionId}/events`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ type: 'user.message', content: message })
      });
      const data = await resp.json();
      if(data.error){
        return { statusCode: 400, body: JSON.stringify({ error: data.error.message, sessionExpired: true }) };
      }

      const reply = await pollForResponse(sessionId, headers);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ reply, sessionId })
      };
    }
  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};

async function pollForResponse(sessionId, headers) {
  const maxAttempts = 30;
  for(let i = 0; i < maxAttempts; i++){
    await new Promise(r => setTimeout(r, 1000));
    const resp = await fetch(`https://api.anthropic.com/v1/sessions/${sessionId}`, { headers });
    const data = await resp.json();
    if(data.status === 'idle' || data.status === 'completed'){
      const evResp = await fetch(`https://api.anthropic.com/v1/sessions/${sessionId}/events?limit=10`, { headers });
      const evData = await evResp.json();
      if(evData.events){
        const msgs = evData.events.filter(e => e.type === 'assistant.message' || e.type === 'agent.message');
        if(msgs.length > 0) return msgs[msgs.length - 1].content || msgs[msgs.length - 1].text || '';
      }
      return 'Session completed.';
    }
  }
  return 'Response took too long - try again.';
}
