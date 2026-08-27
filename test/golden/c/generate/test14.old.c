// [DIGRAPH] диграфы <% %> — это ФИГУРНЫЕ СКОБКИ, записанные другими символами
int pick(int a, int b) <%
    if (a > b) <% return a; %>
    return b;
%>
