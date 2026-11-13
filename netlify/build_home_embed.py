# Builds the home page + EA shop into the app (HOME_SRC_B64). Run after changing home/index.html.
import base64,re
R='/home/claude/triozizzfx-autotrader-public/home/'
h=open(R+'index.html').read()
svg="data:image/svg+xml;base64,"+base64.b64encode(open(R+'logo.svg','rb').read()).decode()
h=h.replace('href="logo.svg"','href="'+svg+'"').replace('src="logo.svg"','src="'+svg+'"')
h=re.sub(r'<link rel="(canonical|apple-touch-icon)"[^>]*>\n?','',h)
b=base64.b64encode(h.encode()).decode()
p='/home/claude/at.html';s=open(p).read()
line='const HOME_SRC_B64="'+b+'";'
if 'const HOME_SRC_B64="' in s: s=re.sub(r'const HOME_SRC_B64="[A-Za-z0-9+/=]*";',lambda m:line,s)
else: s=s.replace('const SIG_SRC_B64="',line+'\nconst SIG_SRC_B64="',1)
open(p,'w').write(s);print("embedded home:",len(h),"chars")
