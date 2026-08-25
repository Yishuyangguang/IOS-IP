export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. 账号自动抓取与过滤接口
    if (url.pathname === "/api/appleid") {
      try {
        const sourceUrl = "https://ccbaohe.com/appleID/";
        const resp = await fetch(sourceUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
          }
        });

        if (!resp.ok) {
          return new Response(JSON.stringify({ success: false, error: "源站响应异常" }), {
            status: 502,
            headers: { "Content-Type": "application/json; charset=utf-8" }
          });
        }

        const html = await resp.text();
        const accounts = [];

        // 匹配 HTML 中所有卡片模块
        // 目标结构：包含【美国】或“美国”，以及 data-clipboard-text 属性
        const cardRegex = /<div[^>]*class="[^"]*(?:card|item|box)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
        const allTextBlocks = html.split(/<\/div>\s*<div[^>]*class="[^"]*(?:card|item|col|grid)[^"]*"/i);

        for (const block of allTextBlocks) {
          // 仅筛选包含“美国”的区块
          if (!block.includes("美国") && !block.includes("【美国】")) {
            continue;
          }

          // 提取包含在 data-clipboard-text 里的账号和密码
          const clipMatches = [...block.matchAll(/data-clipboard-text=["']([^"']+)["']/gi)].map(m => m[1].trim());

          let account = "";
          let password = "";

          if (clipMatches.length >= 2) {
            account = clipMatches[0];
            password = clipMatches[1];
          } else if (clipMatches.length === 1) {
            account = clipMatches[0];
          }

          // 备用邮箱匹配逻辑
          if (!account) {
            const emailMatch = block.match(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/);
            if (emailMatch) account = emailMatch[0];
          }

          // 提取更新时间
          const timeMatch = block.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)?/);
          const updateTime = timeMatch ? timeMatch[0] : "最新可用";

          if (account) {
            accounts.push({
              region: "美国",
              account: account,
              password: password || "点击页面复制获取",
              update_time: updateTime
            });
          }
        }

        // 账号去重
        const uniqueAccounts = [];
        const seen = new Set();
        for (const item of accounts) {
          if (!seen.has(item.account)) {
            seen.add(item.account);
            uniqueAccounts.push(item);
          }
        }

        return new Response(JSON.stringify({
          success: true,
          count: uniqueAccounts.length,
          accounts: uniqueAccounts,
          updatedAt: new Date().toISOString()
        }), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=120, stale-while-revalidate=300" // 缓存2分钟，防止频控
          }
        });

      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      }
    }

    // 2. 静态页面回退托管
    if (env.ASSETS) {
      return await env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  }
};
