╔═ homepage/1) not logged in ═╗
<html>
 <head></head>
 <body>
  <h1>Please login</h1>
  <form action="/login" method="post">
   <input type="text" name="email" placeholder="email"> <input type="submit" value="login">
  </form>
 </body>
</html>
╔═ homepage/1) not logged in[md] ═╗
Please login
╔═ homepage/1) not logged in[statusLine] ═╗
HTTP/1.1 200 OK
╔═ homepage/2) post login form ═╗
<html>
 <head></head>
 <body>
  <h1>Email sent!</h1>
  <p>Check your email for your login link.</p>
 </body>
</html>
╔═ homepage/2) post login form[md] ═╗
Email sent!

Check your email for your login link.
╔═ homepage/2) post login form[statusLine] ═╗
HTTP/1.1 200 OK
╔═ homepage/3) login email ═╗
Click <a href="https://www.example.com/login-confirm/erjchFY=">here</a> to login.
╔═ homepage/3) login email[md] ═╗
Click [here](https://www.example.com/login-confirm/erjchFY=) to login.
╔═ homepage/3) login email[metadata] ═╗
subject=Login to example.com
to=user@domain.com
from=team@example.com
╔═ homepage/4) open login email link ═╗
REDIRECT 302 Found to /
╔═ homepage/4) open login email link[cookies] ═╗
login=user@domain.com|JclThw==;Path=/
╔═ homepage/4) open login email link[md] ═╗
REDIRECT 302 Found to /
╔═ homepage/5) follow redirect ═╗
<html>
 <head></head>
 <body>
  <h1>Welcome back user@domain.com</h1>
 </body>
</html>
╔═ homepage/5) follow redirect[md] ═╗
Welcome back user@domain.com
╔═ homepage/5) follow redirect[statusLine] ═╗
HTTP/1.1 200 OK
╔═ homepage/6) bad signature ═╗
<!doctype html>
<html>
 <head>
  <meta charset="utf-8">
  <style>
body {font-family: "open sans",sans-serif; margin-left: 20px;}
h1 {font-weight: 300; line-height: 44px; margin: 25px 0 0 0;}
h2 {font-size: 16px;font-weight: 300; line-height: 44px; margin: 0;}
footer {font-weight: 300; line-height: 44px; margin-top: 10px;}
hr {background-color: #f7f7f9;}
div.trace {border:1px solid #e1e1e8; background-color: #f7f7f9;}
p {padding-left: 20px;}
p.tab {padding-left: 40px;}
</style>
  <title>Unauthorized (401)</title>
 </head>
 <body>
  <h1>Unauthorized</h1>
  <hr>
  <h2>status code: 401</h2>
 </body>
</html>
╔═ homepage/6) bad signature[md] ═╗
Unauthorized

status code: 401
╔═ homepage/6) bad signature[statusLine] ═╗
HTTP/1.1 401 Unauthorized
╔═ [end of file] ═╗
