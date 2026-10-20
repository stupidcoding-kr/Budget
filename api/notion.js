export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { date, transactions, notionKey, notionDbId } = req.body;

  // Read environment variables from Vercel if set, or fallback to body inputs
  const NOTION_API_KEY = process.env.NOTION_KEY || notionKey;
  const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID || notionDbId;

  if (!NOTION_API_KEY || !NOTION_DATABASE_ID) {
    return res.status(400).json({ error: 'Notion API Key 또는 Database ID가 설정되지 않았습니다.' });
  }

  try {
    // 1. 기존에 해당 날짜(Title)로 생성된 페이지가 있는지 검색
    const searchRes = await fetch(`https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filter: {
          property: 'Title',
          title: {
            equals: date
          }
        }
      })
    });

    const searchData = await searchRes.json();

    // 2. 페이지 본문에 넣을 블록 생성
    const childrenBlocks = [
      {
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: `${date} 가계부 기록` } }]
        }
      }
    ];

    if (!transactions || transactions.length === 0) {
      childrenBlocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: '등록된 거래 내역이 없습니다.' } }]
        }
      });
    } else {
      let totalInc = 0;
      let totalExp = 0;

      transactions.forEach(tx => {
        if (tx.type === 'income') totalInc += Number(tx.amount);
        else totalExp += Number(tx.amount);
      });

      childrenBlocks.push({
        object: 'block',
        type: 'callout',
        callout: {
          rich_text: [{
            type: 'text',
            text: { content: `총 수입: +${totalInc.toLocaleString()}원 | 총 지출: -${totalExp.toLocaleString()}원 (순수입: ${(totalInc - totalExp).toLocaleString()}원)` }
          }],
          icon: { emoji: '📝' }
        }
      });

      childrenBlocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: '상세 거래 내역' } }]
        }
      });

      transactions.forEach(tx => {
        const sign = tx.type === 'income' ? '+' : '-';
        const fixedStr = tx.isFixed ? ' [고정비]' : '';
        const lineText = `[${tx.type === 'income' ? '수입' : '지출'}] ${tx.memo} - ${sign}${Number(tx.amount).toLocaleString()}원 (${tx.category} / ${tx.payment})${fixedStr}`;

        childrenBlocks.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{ type: 'text', text: { content: lineText } }]
          }
        });
      });
    }

    // 3. 이미 동일한 Title(날짜) 페이지가 있다면 덮어쓰기 위해 기존 페이지 아카이브(삭제)
    if (searchData.results && searchData.results.length > 0) {
      for (const page of searchData.results) {
        await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${NOTION_API_KEY}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ archived: true })
        });
      }
    }

    // 4. 새 페이지 생성 (Title과 Date 속성에 날짜 저장)
    const createRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        parent: { database_id: NOTION_DATABASE_ID },
        properties: {
          'Title': {
            title: [
              { text: { content: date } }
            ]
          },
          'Date': {
            date: { start: date }
          }
        },
        children: childrenBlocks
      })
    });

    const createData = await createRes.json();

    if (!createRes.ok) {
      return res.status(createRes.status).json({ error: createData.message || 'Notion 페이지 생성 실패' });
    }

    return res.status(200).json({ success: true, pageId: createData.id });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
