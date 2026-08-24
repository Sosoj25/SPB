@echo off
REM ============================================================
REM  เชื่อม Supabase MCP เข้ากับ Claude Code (โหมดอ่านอย่างเดียว)
REM ============================================================
REM  วิธีใช้ — เปิด cmd แล้วพิมพ์บรรทัดเดียว:
REM
REM      C:\Users\SoSoj\Desktop\sportsbooking\setup-supabase-mcp.cmd sbp_xxxxx
REM
REM  โดย sbp_xxxxx คือ personal access token ตัวใหม่
REM  (Supabase Dashboard -> Account Settings -> Access Tokens)
REM
REM  ไฟล์นี้ไม่ได้เก็บ token ไว้ข้างใน รับมาเป็น argument อย่างเดียว
REM ============================================================

if "%~1"=="" (
    echo.
    echo [!] ยังไม่ได้ใส่ token
    echo.
    echo     วิธีใช้:  setup-supabase-mcp.cmd ^<token^>
    echo     ตัวอย่าง: setup-supabase-mcp.cmd sbp_abc123...
    echo.
    exit /b 1
)

REM ย้าย cwd มาที่โฟลเดอร์ของสคริปต์ เพื่อให้ -s local ผูกกับโปรเจกต์นี้
cd /d "%~dp0"

echo.
echo กำลังเพิ่ม Supabase MCP (read-only) ...
echo.

call claude mcp add supabase -s local -e SUPABASE_ACCESS_TOKEN=%~1 -- npx -y @supabase/mcp-server-supabase@latest --read-only --project-ref=hpqopbeeddljnhidnxym

echo.
echo เสร็จแล้ว — ปิดแล้วเปิด Claude Code ใหม่ จากนั้นสั่ง: claude mcp list
echo.
