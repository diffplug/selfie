<#import "source_set_selector.ftl" as source_set_selector>
<#macro display>
<nav class="navigation" id="navigation-wrapper">
    <div class="navigation--inner">
        <div class="navigation-title">
            <button class="menu-toggle" id="menu-toggle" type="button">toggle menu</button>
            <div class="selfie-navigation-controls" id="searchBar" role="button">search in API</div>
        </div>
    </div>
</nav>
<div class="selfie-container">
    <div class="selfie-sidebar-spacer"></div>
    <div class="selfie-main">
        <div class="selfie-main-content">
            <img src="../../images/antique_humanoid.webp" id="selfie-navigation-bot" class="selfie-navigation-bot"/>
        </div>
    </div>
</div>
<div class="selfie-filter-section">
    <@source_set_selector.display/>
</div>
</#macro>