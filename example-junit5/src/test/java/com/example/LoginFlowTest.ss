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
login=user@domain.com;Path=/
╔═ homepage/4) open login email link[md] ═╗
REDIRECT 302 Found to /
╔═ homepage/5) follow redirect ═╗
<html>
 <head></head>
 <body>
  <h1>Welcome back user@domain.com=null</h1>
 </body>
</html>
╔═ homepage/5) follow redirect[md] ═╗
Welcome back user@domain.com=null
╔═ homepage/5) follow redirect[statusLine] ═╗
HTTP/1.1 200 OK
╔═ [end of file] ═╗
