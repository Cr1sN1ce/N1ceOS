@echo off
call npm install || exit /b 1
call npm test || exit /b 1
call npm run dist || exit /b 1
echo Done: dist\N1ceOS-Setup-1.0.0.exe
pause
