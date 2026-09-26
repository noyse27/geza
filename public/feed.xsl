<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:atom="http://www.w3.org/2005/Atom">
  <xsl:output method="html" encoding="UTF-8"/>
  <xsl:template match="/rss/channel">
    <html lang="de">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title><xsl:value-of select="title"/></title>
        <style>
          body{font:16px/1.5 system-ui,sans-serif;background:#0b0b10;color:#eee;margin:0;padding:24px}
          main{max-width:720px;margin:0 auto}
          a{color:#9ecbff}
          .box{border:1px solid #333;border-radius:8px;padding:16px;margin:16px 0;background:#15151c}
          input{width:100%;box-sizing:border-box;padding:8px;background:#0b0b10;color:#eee;border:1px solid #444;border-radius:6px}
          li{margin:8px 0}
          small{color:#aaa}
        </style>
      </head>
      <body>
        <main>
          <h1><xsl:value-of select="title"/></h1>
          <div class="box">
            <p>Das ist ein RSS-Feed. Kopiere die Adresse in deinen Feed-Reader, um neue Bewertungen und Reviews zu abonnieren.</p>
            <input type="text" readonly="readonly" onfocus="this.select()" value="{atom:link/@href}"/>
          </div>
          <ul>
            <xsl:for-each select="item">
              <li>
                <a href="{link}"><xsl:value-of select="title"/></a><br/>
                <small><xsl:value-of select="pubDate"/></small>
              </li>
            </xsl:for-each>
          </ul>
        </main>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
