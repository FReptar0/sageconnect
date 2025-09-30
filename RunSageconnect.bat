@echo off
cd /d E:\sageconnect
call npm run start
timeout /t 5 /nobreak >nul
exit